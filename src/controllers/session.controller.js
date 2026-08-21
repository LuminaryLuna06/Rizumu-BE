import Session from "../models/session.js";
import User from "../models/user.js";
import Message from "../models/message.js";
import mongoose from "mongoose";
import Friendship from "../models/friendship.js";
import { io } from "../server.js";
import { awardSessionRewards } from "../utils/progressHelper.js";

// Giới hạn học tập tối đa trong 1 ngày: 16 tiếng = 57,600 giây
const MAX_DAILY_SECONDS = 16 * 60 * 60;

/**
 * Tính tổng số giây user đã học trong ngày hôm nay (tính từ 00:00:00 UTC)
 */
const getTodayStudyDuration = async (userId, todayStart, currentSessionId = null) => {
  const result = await Session.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        completed: true,
        started_at: { $gte: todayStart },
        _id: { $ne: currentSessionId ? new mongoose.Types.ObjectId(currentSessionId) : null },
      },
    },
    {
      $group: {
        _id: null,
        totalDuration: { $sum: "$duration" },
      },
    },
  ]);

  return result[0]?.totalDuration || 0;
};

// Bắt đầu session mới
export const startSession = async (req, res) => {
  try {
    const { plannedDuration, timer_type, session_type, tag_id, notes } = req.body;
    const user_id = req.user.id;
    const serverNow = new Date();

    // 1. Tự động đóng bất kỳ phiên chưa hoàn thành trước đó của user để tránh orphan data
    const activeSessions = await Session.find({
      user_id: user_id,
      completed: false,
    });

    for (const oldSession of activeSessions) {
      const elapsed = Math.max(
        0,
        Math.floor((serverNow.getTime() - new Date(oldSession.started_at).getTime()) / 1000)
      );
      oldSession.completed = false;
      oldSession.ended_at = serverNow;
      oldSession.duration = Math.min(elapsed, MAX_DAILY_SECONDS);
      await oldSession.save();
    }

    // 2. Luôn sử dụng timestamp của Server cho started_at (chống clock tampering)
    const session = new Session({
      user_id: user_id,
      completed: false,
      started_at: serverNow,
      plannedDuration: Math.max(0, Number(plannedDuration) || 0),
      ended_at: null,
      duration: 0,
      timer_type: timer_type || "focus",
      session_type: session_type || "pomodoro",
      notes: notes || "",
      tag_id: tag_id || "",
    });

    await session.save();

    if (timer_type === "focus" || session_type === "pomodoro") {
      const user = await User.findById(user_id).select("name current_room_id");
      if (user && user.current_room_id) {
        io.to(user.current_room_id.toString()).emit("new_message", {
          sender_id: user_id,
          content: `${user.name} is aura farming!`,
          createdAt: serverNow.toISOString(),
          type: "system",
        });
      }
    }

    res.status(201).json({ message: "Session started", session });
  } catch (err) {
    console.error("[startSession ERROR]", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { session_id, duration: clientDuration, completed, notes, tag_id } = req.body;
    const serverNow = new Date();

    const query = session_id
      ? { _id: session_id, user_id: userId }
      : { user_id: userId, completed: false };

    const session = await Session.findOne(query).sort({ started_at: -1 });

    if (!session) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy phiên làm việc đang diễn ra." });
    }

    if (session.completed) {
      return res
        .status(400)
        .json({ message: "Phiên làm việc này đã hoàn thành trước đó." });
    }

    // 1. Tính thời gian thực tế đã trôi qua kể từ lúc session bắt đầu
    const serverElapsedSeconds = Math.max(
      0,
      Math.floor((serverNow.getTime() - new Date(session.started_at).getTime()) / 1000)
    );

    // 2. Validate client duration: cho phép nhỏ hơn hoặc bằng serverElapsed (do pause), dung sai +5s
    let validSessionDuration = serverElapsedSeconds;
    if (clientDuration !== undefined && clientDuration !== null) {
      const parsedClientDuration = Math.max(0, Number(clientDuration) || 0);
      validSessionDuration = Math.min(parsedClientDuration, serverElapsedSeconds + 5);
    }

    if (completed === true) {
      // 3. Giới hạn 16 tiếng / ngày (57,600 giây)
      const todayStart = new Date(serverNow);
      todayStart.setUTCHours(0, 0, 0, 0);

      const alreadyStudiedToday = await getTodayStudyDuration(userId, todayStart, session._id);
      const remainingDailySeconds = Math.max(0, MAX_DAILY_SECONDS - alreadyStudiedToday);

      const actualDuration = Math.min(validSessionDuration, remainingDailySeconds);
      const isDailyLimitReached = (alreadyStudiedToday + actualDuration) >= MAX_DAILY_SECONDS;

      session.completed = true;
      session.ended_at = serverNow;
      session.duration = actualDuration;
      if (notes !== undefined) session.notes = notes;
      if (tag_id !== undefined) session.tag_id = tag_id;

      // 4. Tính toán phần thưởng tự động
      const earnedXp = Math.floor(actualDuration / 60);
      const earnedCoins = Math.floor(actualDuration / 600);
      const isFullPomodoro = session.plannedDuration && session.plannedDuration > 0
        ? actualDuration >= (session.plannedDuration - 10)
        : false;

      let rewardProgress = null;
      if (session.session_type === "pomodoro" || session.timer_type === "focus") {
        rewardProgress = await awardSessionRewards({
          userId,
          earnedXp,
          earnedCoins,
          isFullPomodoro,
          durationSeconds: actualDuration,
        });

        const user = await User.findById(userId).select("name current_room_id");
        if (user && user.current_room_id) {
          io.to(user.current_room_id.toString()).emit("new_message", {
            sender_id: userId,
            content: `${user.name} has finished aura farming!`,
            createdAt: serverNow.toISOString(),
            type: "system",
          });
        }
      }

      await session.save();

      return res.status(200).json({
        message: isDailyLimitReached
          ? "Bạn đã đạt giới hạn học tập tối đa 16 tiếng hôm nay!"
          : isFullPomodoro
          ? "Hoàn thành chu kỳ Pomodoro!"
          : "Cập nhật session thành công",
        session,
        rewards: {
          earnedXp,
          earnedCoins,
          isFullPomodoro,
          progress: rewardProgress,
        },
        meta: {
          todayTotalHours: parseFloat(((alreadyStudiedToday + actualDuration) / 3600).toFixed(2)),
          isDailyLimitReached,
        },
      });
    }

    // Nếu chỉ cập nhật thông tin giữa phiên (ghi chú, tag, duration tạm thời)
    if (notes !== undefined) session.notes = notes;
    if (tag_id !== undefined) session.tag_id = tag_id;
    session.duration = validSessionDuration;

    await session.save();

    res.status(200).json({ message: "Cập nhật session thành công", session });
  } catch (err) {
    console.error("[updateSession ERROR]", err);
    res.status(500).json({ message: err.message });
  }
};

export const heatmapData = async (req, res) => {
  try {
    const { user_id, startTime, endTime } = req.query;
    const timezone = "+00:00";
    const maybeUserId = user_id ?? req.user?.id;
    if (!maybeUserId || !mongoose.Types.ObjectId.isValid(maybeUserId)) {
      return res.status(400).json({ error: "Invalid or missing user id" });
    }
    if (!startTime || !endTime || !timezone) {
      return res
        .status(400)
        .json({ error: "Missing params: startTime, endTime, or timezone" });
    }

    const userObjectId = new mongoose.Types.ObjectId(maybeUserId);
    const start = new Date(startTime);
    const end = new Date(endTime);

    const rawSessions = await Session.aggregate([
      {
        $match: {
          user_id: userObjectId,
          completed: true,
          started_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$started_at",
              timezone: timezone,
            },
          },
          duration: { $sum: "$duration" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dataMap = {};
    rawSessions.forEach((item) => {
      dataMap[item._id] = item.duration;
    });

    const durations = [];
    //phần tính toán thời gian
    const sign = timezone.startsWith("-") ? -1 : 1;
    const hours = parseInt(timezone.slice(1, 3), 10);
    const mins = parseInt(timezone.slice(4, 6), 10);
    const offsetMs = sign * (hours * 3600000 + mins * 60000);

    const oneDayMs = 24 * 60 * 60 * 1000;

    let currentPointer = start.getTime();
    const endPointer = end.getTime();

    while (currentPointer <= endPointer) {
      // Tạo "thời gian ảo" bằng cách cộng lệch múi giờ vào timestamp UTC hiện tại
      const fakeLocalDate = new Date(currentPointer + offsetMs);
      const dateString = fakeLocalDate.toISOString().split("T")[0];

      // Lấy dữ liệu từ Map, nếu không có thì là 0
      durations.push(dataMap[dateString] || 0);
      currentPointer += oneDayMs;
    }

    const startDateLocal = new Date(start.getTime() + offsetMs)
      .toISOString()
      .split("T")[0];
    const endDateLocal = new Date(end.getTime() + offsetMs)
      .toISOString()
      .split("T")[0];

    res.json({
      start_date: startDateLocal,
      end_date: endDateLocal,
      durations,
    });
  } catch (err) {
    console.error("[heatmapData ERROR]", err);
    res.status(500).json({ error: err.message });
  }
};

export const getHourlyStats = async (req, res) => {
  try {
    const { startTime, endTime, userId } = req.query;

    if (!startTime || !endTime || !userId) {
      return res.status(400).json({ message: "Missing params" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    const sessions = await Session.find({
      user_id: userId,
      completed: true,
      started_at: { $lte: end },
      ended_at: { $gte: start },
    });

    const hourlyStats = new Array(24).fill(0);

    sessions.forEach((session) => {
      const sessionStartMs = new Date(session.started_at).getTime();
      const sessionEndMs = new Date(session.ended_at).getTime();
      const totalElapsedMs = sessionEndMs - sessionStartMs;

      if (totalElapsedMs <= 0) return;

      const durationInSeconds = session.duration || totalElapsedMs / 1000;
      const focusRatio = Math.min(
        (durationInSeconds * 1000) / totalElapsedMs,
        1
      );

      // Vòng lặp tính toán (Quan trọng: Dựa trên startTime)
      for (let i = 0; i < 24; i++) {
        const hourStartMs = start.getTime() + i * 60 * 60 * 1000;
        const hourEndMs = hourStartMs + 60 * 60 * 1000;

        const overlapStart = Math.max(sessionStartMs, hourStartMs);
        const overlapEnd = Math.min(sessionEndMs, hourEndMs);
        const overlapMs = overlapEnd - overlapStart;

        if (overlapMs > 0) {
          const focusedMinutes = (overlapMs * focusRatio) / 1000 / 60;
          hourlyStats[i] += focusedMinutes;
        }
      }
    });

    const result = hourlyStats.map((m) => Number(m.toFixed(2)));
    res.status(200).json(result);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
export const getDailySession = async (req, res) => {
  try {
    const { startTime, endTime, userId } = req.query;

    if (!startTime || !endTime || !userId) {
      return res.status(400).json({ message: "Missing params" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    const sessions = await Session.find({
      user_id: userId,
      completed: true,
      started_at: { $lte: end },
      ended_at: { $gte: start },
    });

    res.status(200).json(sessions);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
export const changeNote = async (req, res) => {
  try {
    const { session_id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;
    const session = await Session.findOneAndUpdate(
      {
        _id: session_id,
        user_id: userId,
      },
      { notes },
      { new: true, runValidators: true }
    );

    if (!session) {
      return res.status(404).json({
        message:
          "Không tìm thấy phiên làm việc hoặc bạn không có quyền chỉnh sửa.",
      });
    }

    return res.status(200).json({
      message: "Cập nhật ghi chú thành công",
      session,
    });
  } catch (err) {
    console.error("[CHANGE NOTE ERROR]", err);
    if (err.name === "CastError") {
      return res
        .status(400)
        .json({ message: "ID phiên làm việc không hợp lệ" });
    }
    return res
      .status(500)
      .json({ message: "Lỗi hệ thống khi cập nhật ghi chú" });
  }
};
export const changeTag = async (req, res) => {
  try {
    const { session_id } = req.params;
    const { tag_id } = req.body;
    const userId = req.user.id;
    const session = await Session.findOneAndUpdate(
      {
        _id: session_id,
        user_id: userId,
      },
      { tag_id },
      { new: true, runValidators: true }
    );

    if (!session) {
      return res.status(404).json({
        message:
          "Không tìm thấy phiên làm việc hoặc bạn không có quyền chỉnh sửa.",
      });
    }

    return res.status(200).json({
      message: "Cập nhật tag thành công",
      session,
    });
  } catch (err) {
    console.error("[CHANGE TAG ERROR]", err);
    if (err.name === "CastError") {
      return res
        .status(400)
        .json({ message: "ID phiên làm việc không hợp lệ" });
    }
    return res.status(500).json({ message: "Lỗi hệ thống khi cập nhật tag" });
  }
};
export const getLeaderboard = async (req, res) => {
  try {
    const { startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "Missing params: startTime or endTime" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    const leaderboard = await Session.aggregate([
      {
        $match: {
          completed: true,
          started_at: { $gte: start, $lte: end },
          duration: { $gt: 0, $lte: 86400 },
        },
      },

      {
        $group: {
          _id: "$user_id",
          totalDuration: { $sum: "$duration" }, // Cộng dồn duration
          sessionsCount: { $sum: 1 },
        },
      },

      {
        $sort: { totalDuration: -1 },
      },
      //lấy top 50
      {
        $limit: 50,
      },

      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },

      {
        $unwind: "$userInfo",
      },

      //lấy dữ liệu chuẩn trả về front-end
      {
        $project: {
          id: 1,
          totalDuration: 1,
          sessionsCount: 1,
          name: "$userInfo.name",
          avatar: "$userInfo.avatar",
          // username: "$userInfo.username",
          bio: "$userInfo.bio",
        },
      },
    ]);

    //Trả về kết quả
    res.json({
      data: leaderboard,
      startTime: start,
      endTime: end,
    });
  } catch (err) {
    console.error("[getLeaderboard ERROR]", err);
    res.status(500).json({ error: err.message });
  }
};
export const getLeaderboardFriends = async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    const userId = req.user.id;

    if (!startTime || !endTime) {
      return res
        .status(400)
        .json({ error: "Missing params: startTime or endTime" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { receiver: userId }],
      status: "accepted",
    });

    const friendIds = friendships.map((f) => {
      return f.requester.toString() === userId.toString()
        ? f.receiver
        : f.requester;
    });

    friendIds.push(new mongoose.Types.ObjectId(userId));

    const leaderboard = await Session.aggregate([
      {
        $match: {
          completed: true,
          started_at: { $gte: start, $lte: end },
          duration: { $gt: 0, $lte: 86400 },
          user_id: {
            $in: friendIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
      },
      {
        $group: {
          _id: "$user_id",
          totalDuration: { $sum: "$duration" },
          sessionsCount: { $sum: 1 },
        },
      },
      { $sort: { totalDuration: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          id: 1,
          totalDuration: 1,
          sessionsCount: 1,
          name: "$userInfo.name",
          avatar: "$userInfo.avatar",
          // username: "$userInfo.username",
          bio: "$userInfo.bio",
        },
      },
    ]);

    res.json({
      data: leaderboard,
      startTime: start,
      endTime: end,
    });
  } catch (err) {
    console.error("[getLeaderboardFriends ERROR]", err);
    res.status(500).json({ error: err.message });
  }
};
