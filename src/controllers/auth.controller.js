//xong
import User from "../models/user.js";
import jwt from "jsonwebtoken";
import Progress from "../models/progress.js";
import { v2 as cloudinary } from "cloudinary";
import Room from "../models/room.js";
//phần lấy token
const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "access_secret_123";
const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "refresh_secret_456";
const ACCESS_TOKEN_EXPIRES = "15m";
const REFRESH_TOKEN_EXPIRES = "7d";
//các hàm helper
//logic: Access hết hạn front-end sẽ tạo ra access mới từ refresh token nếu bị chiếm access token hacker sẽ chỉ dùng được trong 15p
// Tạo Access Token từ các key ở trên
function signAccessToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
}

// Tạo refreshtoken từ jwwt
function signRefreshToken(user) {
  return jwt.sign({ id: user._id }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES,
  });
}

const setRefreshTokenCookie = (res, token) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,
    // secure: process.env.NODE_ENV === "production",
    secure: true,
    // sameSite: "Lax",
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

//đăng kí
export const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: "Missing username or password" });

    const existed = await User.findOne({ username });
    if (existed)
      return res.status(400).json({ message: "username already taken" });

    const user = new User({
      username,
      name: "Anonymous User",
    });

    //sử lý phần hash pass ở db
    user.password = password;

    // Tạo 2 token
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    user.refreshToken = refreshToken;
    user.status = "online";

    //phần tạo phòng mặc định
    const newRoom = new Room({
      name: "Study Room",
      description: "Your personal space!",
      owner_id: user._id,
      room_members: [
        {
          user_id: user._id,
          role: "admin",
        },
      ],
    });
    user.default_room_id = newRoom._id;
    user.current_room_id = newRoom._id;

    await user.save();
    await newRoom.save();

    setRefreshTokenCookie(res, refreshToken);

    await Progress.create({
      user: user._id,
      coins: 10,
      level: 1,
      current_xp: 0,
      remaining_xp: 50,
      streak: 0,
      total_hours: 0,
      promo_complete: 0,
      gifts: [],
    });

    return res.status(201).json({
      message: "Register success",
      data: {
        _id: user._id,
        // username: user.username,
        name: user.name,
        status: user.status,
        avatar: user.avatar,
        current_room_id: user.current_room_id,
        default_room_id: user.default_room_id,
        bio: user.bio,
        country: user.country,
      },
      access_token: accessToken,
      //refresh_token: refreshToken,
    });
  } catch (err) {
    console.error("[REGISTER ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ message: "Missing username or password" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });

    //phần tạo mới nếu người dùng đang nhập lại hacker sẽ mất session đang có
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    //cập nhật
    user.status = "online";
    user.refreshToken = refreshToken;
    await user.save();

    // Gửi Refresh Token qua Cookie
    setRefreshTokenCookie(res, refreshToken);

    return res.json({
      message: "Login success",
      data: {
        _id: user._id,
        // username: user.username,
        name: user.name,
        status: user.status,
        avatar: user.avatar,
        current_room_id: user.current_room_id,
        default_room_id: user.default_room_id,
        bio: user.bio,
        country: user.country,
      },
      access_token: accessToken,
      //refresh_token: refreshToken,
    });
  } catch (err) {
    console.error("[LOGIN ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};

//phần lấy access token từ refresh token
export const requestRefreshToken = async (req, res) => {
  try {
    const refresh_token = req.cookies.refreshToken;
    if (!refresh_token)
      return res.status(401).json({ message: "No refresh token provided" });

    // sử dụng jwt để xác thự refresh token
    let decoded;
    try {
      decoded = jwt.verify(refresh_token, REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res
        .status(403)
        .json({ message: "Invalid or expired refresh token" });
    }

    const user = await User.findById(decoded.id);
    if (!user) return res.status(403).json({ message: "User not found" });

    //nếu khác thì từ chối mọi api gửi đến yêu cầu phần xác thực
    if (user.refreshToken !== refresh_token) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    // Cấp Access Token mới
    const newAccessToken = signAccessToken(user);

    return res.json({
      access_token: newAccessToken,
    });
  } catch (err) {
    console.error("[REFRESH ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};

//lấy profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "-password_hash -refreshToken" //loại bỏ các trường nguy hiểm
    );
    const data = user;
    return res.json({ data });
  } catch (err) {
    return res.status(500).json({ message: "Server error" });
  }
};

//đăng xuất
export const logout = async (req, res) => {
  try {
    // 1. Cập nhật Database: Xóa refresh token và set lại status
    // Lưu ý: req.user.id có được là nhờ bạn đã chạy middleware verifyToken trước đó
    const user = await User.findById(req.user.id);

    if (user) {
      user.status = "offline";
      user.refreshToken = null;
      user.accessToken = null;
      await user.save();
    }

    // 2. QUAN TRỌNG: Xóa Cookie ở phía Trình duyệt
    // Bạn phải truyền các option giống hệt lúc bạn res.cookie(...)
    // (ngoại trừ maxAge và expires) để trình duyệt tìm đúng cookie để xóa.
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: "true",
      sameSite: "none", // Hoặc 'None' nếu bạn dùng Cross-site
      // path: "/" // Nếu lúc set bạn có để path thì lúc xóa cũng phải có
    });

    // 3. Phản hồi cho client
    return res.status(200).json({
      message: "Logout success",
      status: "offline",
    });
  } catch (err) {
    console.error("[LOGOUT ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};
//phần upload link ảnh sử dụng cloudy
export const updateAvatar = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    // Nếu có avatar cũ → xóa trên Cloudinary
    if (user.avatar_public_id) {
      try {
        await cloudinary.uploader.destroy(user.avatar_public_id);
      } catch (err) {
        console.log("Error removing old avatar: ", err.message);
      }
    }

    user.avatar = req.file.path;
    user.avatar_public_id = req.file.filename;
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Upload failed" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    //chỗ được phép sửa tránh đụng đến một số thành phần quan trọng
    const { name, country, bio, password, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    //nếu thay đổi username thì phải check trùng
    // if (username && username !== user.username) {
    //   const existingUser = await User.findOne({ username });
    //   if (existingUser) {
    //     return res.status(400).json({ message: "username already taken" });
    //   }
    //   user.username = username;
    // }

    if (name !== undefined) user.name = name;
    if (bio !== undefined) user.bio = bio;
    if (country !== undefined) user.country = country;

    if (password) {
      if (password.length < 6) {
        return res
          .status(400)
          .json({ message: "Password must be at least 6 characters" });
      }
      // phần này hash tự động bên db
      user.password = password;
    }

    await user.save();

    return res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        // username: user.username,
        name: user.name,
        bio: user.bio,
        country: user.country,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("[UPDATE PROFILE ERROR]", err);
    if (err.message.includes("Password must be at least")) {
      return res.status(400).json({ message: err.message });
    }
    return res.status(500).json({ message: "Server error" });
  }
};
//phần lấy id
export const getProfilebyID = async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId) return res.status(400).json({ message: "Thiếu user_id" });

    const data = await User.findById(userId).select(
      "-password -password_hash -refreshToken -__v -avatar_public_id -username"
    ); //loại bỏ các trường nguy hiểm

    if (!data)
      return res.status(404).json({ message: "Không tìm thấy người dùng" });

    return res.json({ data });
  } catch (err) {
    console.error("[GET PROFILE BY ID ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};
// tìm kiếm theo username (email)
export const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const currentUserId = req.user.id;
    if (!q || q.trim() === "") {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập từ khóa tìm kiếm" });
    }

    const searchQuery = q.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValidEmail = emailRegex.test(searchQuery);

    if (!isValidEmail) {
      return res.status(400).json({
        message: "Vui lòng nhập email hợp lệ để tìm kiếm",
      });
    }

    const users = await User.find({
      username: searchQuery.toLowerCase(),
      _id: { $ne: currentUserId },
    })
      .select("bio avatar name")
      .limit(10);

    return res.status(200).json(users);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Lỗi server khi tìm kiếm người dùng" });
  }
};

// Đổi mật khẩu
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.password_hash) {
      // User registered via Google/OAuth without an initial password
      user.password = newPassword;
      await user.save();
      return res.json({ message: "Password set successfully" });
    }

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Mật khẩu hiện tại không chính xác" });
    }

    user.password = newPassword;
    await user.save();

    return res.json({ message: "Đổi mật khẩu thành công" });
  } catch (err) {
    console.error("[CHANGE PASSWORD ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Đăng nhập / Đăng ký Google (Firebase Auth)
export const googleLogin = async (req, res) => {
  try {
    const { email, name, avatar, googleId } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    let user = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedEmail }],
    });

    if (!user) {
      // Tạo user mới nếu lần đầu đăng nhập Google
      user = new User({
        username: normalizedEmail,
        email: normalizedEmail,
        name: name || normalizedEmail.split("@")[0],
        avatar: avatar || null,
        status: "online",
      });

      const newRoom = new Room({
        name: "Study Room",
        description: "Your personal space!",
        owner_id: user._id,
        room_members: [
          {
            user_id: user._id,
            role: "admin",
          },
        ],
      });

      user.default_room_id = newRoom._id;
      user.current_room_id = newRoom._id;

      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);
      user.refreshToken = refreshToken;

      await user.save();
      await newRoom.save();

      await Progress.create({
        user: user._id,
        coins: 10,
        level: 1,
        current_xp: 0,
        remaining_xp: 50,
        streak: 0,
        total_hours: 0,
        promo_complete: 0,
        gifts: [],
      });

      setRefreshTokenCookie(res, refreshToken);

      return res.status(201).json({
        message: "Google login successful",
        data: {
          _id: user._id,
          name: user.name,
          email: user.email,
          status: user.status,
          avatar: user.avatar,
          current_room_id: user.current_room_id,
          default_room_id: user.default_room_id,
          bio: user.bio,
          country: user.country,
        },
        access_token: accessToken,
      });
    }

    // User đã tồn tại
    if (!user.email) {
      user.email = normalizedEmail;
    }
    if (!user.avatar && avatar) {
      user.avatar = avatar;
    }
    user.status = "online";

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    user.refreshToken = refreshToken;
    await user.save();

    setRefreshTokenCookie(res, refreshToken);

    return res.json({
      message: "Google login successful",
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
        avatar: user.avatar,
        current_room_id: user.current_room_id,
        default_room_id: user.default_room_id,
        bio: user.bio,
        country: user.country,
      },
      access_token: accessToken,
    });
  } catch (err) {
    console.error("[GOOGLE LOGIN ERROR]", err);
    return res.status(500).json({ message: "Server error" });
  }
};
