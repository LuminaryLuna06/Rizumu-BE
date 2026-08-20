//xong
import Progress from "../models/progress.js";
import User from "../models/user.js";
import Session from "../models/session.js";
import mongoose from "mongoose";

export const getStreakStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const TIMEZONE_STRING = "UTC";

    // 1. Aggregation: Lấy danh sách ngày tập (Unique & Sorted Tăng dần)
    const datesResult = await Session.aggregate([
      {
        $match: {
          user_id: userObjectId,
          completed: true,
        },
      },
      {
        $project: {
          // chuyển sang chuỗi ngày tháng năm
          dateStr: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$started_at",
              timezone: TIMEZONE_STRING,
            },
          },
        },
      },
      {
        $group: { _id: "$dateStr" }, // nhóm lại và bỏ trùng lặp
      },
      {
        $sort: { _id: 1 }, // phần sắp xếp cũ mới
      },
    ]);

    // Nếu chưa tập buổi nào
    if (!datesResult || datesResult.length === 0) {
      return res.status(200).json({ currentStreak: 0, bestStreak: 0 });
    }

    //chuyển thành mảng các string ngày
    const sortedDates = datesResult.map((item) => item._id);

    // ta tận dụng để làm streak và
    let tempStreak = 1; // Chuỗi tạm thời đang đếm
    let maxStreak = 1; // Kỷ lục

    for (let i = 0; i < sortedDates.length - 1; i++) {
      const currentDate = new Date(sortedDates[i]);
      const nextDate = new Date(sortedDates[i + 1]);

      // Tính khoảng cách ngày
      const diffTime = nextDate - currentDate;
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // nếu tăng liên tiếp thì tăng tạm chuỗi
        tempStreak++;
      } else {
        // đứt thì về 1
        tempStreak = 1;
      }

      // Cập nhật kỷ lục nếu chuỗi tạm vượt qua kỷ lục cũ
      if (tempStreak > maxStreak) {
        maxStreak = tempStreak;
      }
    }

    //nếu chuỗi đứt ta sẽ so sánh với beststreak để quyết định bestreak

    let currentStreak = 0;

    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const lastWorkoutDate = sortedDates[sortedDates.length - 1];

    if (lastWorkoutDate === todayStr || lastWorkoutDate === yesterdayStr) {
      currentStreak = tempStreak;
    } else {
      currentStreak = 0; // Đã bỏ tập quá lâu
    }

    return res.status(200).json({
      currentStreak,
      bestStreak: maxStreak,
    });
  } catch (err) {
    console.error("Get Streak Stats Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getProgress = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // timezone - sử dụng UTC
    const TIMEZONE_OFFSET = 0;
    const TIMEZONE_STRING = "UTC";
    const now = new Date();
    const nowUTC = now; // Sử dụng trực tiếp UTC

    // xác định thời điểm bắt đầu tuần (UTC)
    const currentDayUTC = nowUTC.getUTCDay() || 7;
    const startOfWeekUTC = new Date(nowUTC);
    startOfWeekUTC.setUTCDate(startOfWeekUTC.getUTCDate() - currentDayUTC + 1);
    startOfWeekUTC.setUTCHours(0, 0, 0, 0);
    const queryStartOfWeek = startOfWeekUTC;

    const [sessionStats, giftSentResult] = await Promise.all([
      Session.aggregate([
        {
          $match: {
            user_id: userObjectId,
            completed: true,
          },
        },
        {
          $facet: {
            overall: [
              {
                $group: {
                  _id: null,
                  totalPromo: { $sum: 1 },
                  totalDuration: { $sum: "$duration" },
                  uniqueDays: {
                    $addToSet: {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$started_at",
                        timezone: TIMEZONE_STRING,
                      },
                    },
                  },
                },
              },
            ],
            weekly: [
              { $match: { started_at: { $gte: queryStartOfWeek } } },
              { $count: "count" },
            ],
            datesForStreak: [
              {
                $project: {
                  dateStr: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$started_at",
                      timezone: TIMEZONE_STRING,
                    },
                  },
                },
              },
              { $group: { _id: "$dateStr" } },
              { $sort: { _id: -1 } },
            ],
          },
        },
      ]),
      // Query Gifts
      Progress.aggregate([
        { $unwind: "$gifts" },
        { $match: { "gifts.senderId": userObjectId } },
        { $count: "sent_count" },
      ]),
    ]);

    //
    const stats = sessionStats[0];
    const overall = stats.overall[0] || {
      totalPromo: 0,
      totalDuration: 0,
      uniqueDays: [],
    };
    const weekCount = stats.weekly[0] ? stats.weekly[0].count : 0;
    const sortedDates = stats.datesForStreak.map((d) => d._id); // mảng ngày thứ tự
    const calculatedGiftsSent = giftSentResult[0]
      ? giftSentResult[0].sent_count
      : 0;

    const calculatedTotalHours = parseFloat(
      (overall.totalDuration / 3600).toFixed(2)
    );
    const activeDaysCount = overall.uniqueDays.length;
    const calculatedDailyAvg =
      activeDaysCount > 0
        ? parseFloat((calculatedTotalHours / activeDaysCount).toFixed(2))
        : 0;

    let currentStreak = 0;
    let bestStreak = 0;

    const todayStr = nowUTC.toISOString().split("T")[0];
    const yesterdayUTC = new Date(nowUTC);
    yesterdayUTC.setUTCDate(yesterdayUTC.getUTCDate() - 1);
    const yesterdayStr = yesterdayUTC.toISOString().split("T")[0];

    if (sortedDates.length > 0) {
      let tempStreak = 1;
      let isFirstBlock = true; // Cờ đánh dấu đây có phải là chuỗi đầu tiên (mới nhất) không

      // Kiểm tra xem chuỗi mới nhất có hợp lệ để tính Current Streak không (phải là hôm nay hoặc hôm qua)
      const isLatestValid =
        sortedDates[0] === todayStr || sortedDates[0] === yesterdayStr;

      for (let i = 0; i < sortedDates.length; i++) {
        // Nếu không phải phần tử cuối cùng, so sánh với phần tử kế tiếp
        if (i < sortedDates.length - 1) {
          const current = new Date(sortedDates[i]);
          const previous = new Date(sortedDates[i + 1]); // Vì sort -1 nên previous là ngày cũ hơn

          const diffTime = current - previous;
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays === 1) {
            // Vẫn liên tiếp
            tempStreak++;
          } else {
            // Đã bị ngắt quãng (Gap) -> Tổng kết chuỗi vừa rồi

            // 1. Cập nhật Best Streak
            if (tempStreak > bestStreak) {
              bestStreak = tempStreak;
            }

            // 2. Cập nhật Current Streak (Chỉ lấy chuỗi đầu tiên nếu nó hợp lệ)
            if (isFirstBlock) {
              if (isLatestValid) {
                currentStreak = tempStreak;
              }
              isFirstBlock = false; // Các chuỗi sau (trong quá khứ) không còn là current nữa
            }

            // Reset temp để đếm chuỗi mới trong quá khứ
            tempStreak = 1;
          }
        } else {
          // Đây là phần tử cuối cùng của mảng -> Kết thúc chuỗi đang đếm
          if (tempStreak > bestStreak) {
            bestStreak = tempStreak;
          }
          if (isFirstBlock && isLatestValid) {
            currentStreak = tempStreak;
          }
        }
      }
    }

    //dữ liệu trả về cho front-end
    return res.status(200).json({
      success: true,
      data: {
        streak: currentStreak,
        best_streak: bestStreak,
        total_hours: calculatedTotalHours,
        promo_complete: overall.totalPromo,
        week_promo_complete: weekCount,
        daily_average: calculatedDailyAvg,
        gifts_sent: calculatedGiftsSent,
      },
    });
  } catch (error) {
    console.error("Get Progress Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};
export const getGifts = async (req, res) => {
  try {
    const userId = req.user.id;

    const progress = await Progress.findOne({ user: userId }).populate({
      path: "gifts.senderId",
      select: "name ",
    });

    if (!progress) return res.status(404).json({ message: "Not found" });

    const flattenedGifts = progress.gifts.map((gift) => {
      return {
        id: gift._id,
        icon: gift.icon,
        claimedAt: gift.claimedAt,
        createdAt: gift.createdAt,
        senderId: gift.senderId?._id || null,
        senderName: gift.senderId?.name || "Người dùng ẩn danh",
      };
    });

    return res.json({ data: flattenedGifts });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Error" });
  }
};
export const getGiftsbyId = async (req, res) => {
  try {
    const { userId } = req.params;

    const progress = await Progress.findOne({ user: userId }).populate({
      path: "gifts.senderId",
      select: "name avatar",
    });

    if (!progress) return res.status(404).json({ message: "Not found" });

    const flattenedGifts = progress.gifts.map((gift) => {
      return {
        id: gift._id,
        icon: gift.icon,
        claimedAt: gift.claimedAt,
        createdAt: gift.createdAt,
        senderId: gift.senderId?._id || null,
        senderName: gift.senderId?.name || "Người dùng ẩn danh",
      };
    });

    return res.json({ data: flattenedGifts });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Error" });
  }
};

export const sendGift = async (req, res) => {
  try {
    const { receiverId, icon, price } = req.body;
    const senderId = req.user.id;
    const giftPrice = Math.max(0, Number(price) || 0);

    if (receiverId === senderId) {
      return res
        .status(400)
        .json({ message: "You cannot send a gift to yourself" });
    }

    const [senderProgress, receiverProgress] = await Promise.all([
      Progress.findOne({ user: senderId }),
      Progress.findOne({ user: receiverId }),
    ]);

    if (!senderProgress) {
      return res.status(404).json({ message: "Sender progress not found" });
    }

    if (!receiverProgress) {
      return res.status(404).json({ message: "Receiver progress not found" });
    }

    if (senderProgress.coins < giftPrice) {
      return res
        .status(400)
        .json({ message: "Not enough coins to send this gift" });
    }

    const newGift = {
      senderId: senderId,
      icon: icon,
      claimed: false,
      createdAt: new Date(),
    };

    // Push gift to receiver
    await Progress.findOneAndUpdate(
      { user: receiverId },
      { $push: { gifts: newGift } }
    );

    // Deduct coins and increment gifts_sent on sender atomically
    const updatedSender = await Progress.findOneAndUpdate(
      { user: senderId },
      { $inc: { gifts_sent: 1, coins: -giftPrice } },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Gift sent successfully!",
      gift: newGift,
      coins: updatedSender?.coins ?? (senderProgress.coins - giftPrice),
    });
  } catch (error) {
    console.error("[sendGift ERROR]", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
const calculateNextLevelXp = (currentLevel) => {
  // Công thức: (50*L)^1.2
  return Math.round(Math.pow(50 * currentLevel, 1.2));
};
//cả phần bên dưới có tác dụng cộng thêm phần xp và coin vào cho user khi front-end gọi
export const increaseUserProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_xp: xpToAdd, coins } = req.body;

    if (xpToAdd === undefined && coins === undefined) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    if (
      (xpToAdd !== undefined && typeof xpToAdd !== "number") ||
      (coins !== undefined && typeof coins !== "number")
    ) {
      return res.status(400).json({ message: "Values must be numbers" });
    }

    let progress = await Progress.findOne({ user: userId });

    if (!progress) {
      return res.status(404).json({ message: "Progress not found" });
    }

    if (coins !== undefined) {
      progress.coins += coins;
    }

    if (xpToAdd !== undefined) {
      progress.current_xp += xpToAdd;

      // Nếu đây là lần đầu hoặc dữ liệu cũ chưa có mốc level tiếp theo
      if (!progress.remaining_xp || progress.remaining_xp === 0) {
        progress.remaining_xp = calculateNextLevelXp(progress.level);
      }

      // Trong khi XP tổng lớn hơn hoặc bằng mốc XP cần thiết của level hiện tại
      while (progress.current_xp >= progress.remaining_xp) {
        progress.level += 1;
        // Tính toán mốc XP mới cần đạt được để lên level tiếp theo
        progress.remaining_xp = calculateNextLevelXp(progress.level);
      }
    }

    await progress.save();

    return res.json({
      success: true,
      data: {
        level: progress.level,
        current_xp: progress.current_xp,
        remaining_xp: progress.remaining_xp,
        coins: progress.coins,
      },
    });
  } catch (err) {
    console.error("Increase Progress Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getUserProgress = async (req, res) => {
  try {
    const userId = req.user.id;

    const progress = await Progress.findOne({ user: userId });
    if (!progress) {
      return res.status(404).json({ message: "Progress not found" });
    }

    return res.json({
      success: true,
      data: {
        level: progress.level,
        current_xp: progress.current_xp,
        remaining_xp: progress.remaining_xp,
        coins: progress.coins,
      },
    });
  } catch (err) {
    console.error("Get User Progress Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
export const getUserProgressbyId = async (req, res) => {
  try {
    const { userId } = req.params;

    const progress = await Progress.findOne({ user: userId });
    if (!progress) {
      return res.status(404).json({ message: "Progress not found" });
    }

    return res.json({
      success: true,
      data: {
        level: progress.level,
        current_xp: progress.current_xp,
        remaining_xp: progress.remaining_xp,
        coins: progress.coins,
      },
    });
  } catch (err) {
    console.error("Get User Progress Error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
