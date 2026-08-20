// routes/auth.routes.js
import express from "express";
import {
  register,
  login,
  requestRefreshToken,
  getProfile,
  logout,
  updateProfile,
  getProfilebyID,
  searchUsers,
  changePassword,
  googleLogin,
} from "../controllers/auth.controller.js";
import uploadAvatar from "../middlewares/uploadAvata.middleware.js";
import { updateAvatar } from "../controllers/auth.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
//phần vadiate dữ liệu
import { validate } from "../middlewares/validate.js";
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  updateProfileSchema,
  getProfileByIdSchema,
  searchUserSchema,
  changePasswordSchema,
  googleLoginSchema,
} from "../validators/auth.validator.js";
import redisRateLimit from "../middlewares/redisRateLimit.js";
const router = express.Router();

const authStrictLimit = redisRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: "rl:auth-strict",
});

const updateLimit = redisRateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  keyPrefix: "rl:auth-update",
});

const generalLimit = redisRateLimit({
  windowMs: 1 * 60 * 1000, // 1 phút
  max: 30, // 30 requests/phút
  keyPrefix: "rl:auth-general",
});

router.post("/register", authStrictLimit, validate(registerSchema), register);
router.post("/login", authStrictLimit, validate(loginSchema), login);
router.post("/google", authStrictLimit, validate(googleLoginSchema), googleLogin);

// Refresh token
router.post(
  "/refresh",
  generalLimit,
  // validate(refreshTokenSchema),
  requestRefreshToken
);

// Profile: Phải đặt SAU verifyToken để lấy được req.user.id
router.get("/profile", verifyToken, generalLimit, getProfile);

router.post("/logout", verifyToken, logout);

// Đổi mật khẩu
router.post(
  "/change-password",
  verifyToken,
  updateLimit,
  validate(changePasswordSchema),
  changePassword
);

// Upload ảnh: Giới hạn chặt vì tốn băng thông server
router.post(
  "/avatar",
  verifyToken,
  updateLimit,
  uploadAvatar.single("avatar"),
  updateAvatar
);

router.patch(
  "/profile",
  verifyToken,
  updateLimit,
  validate(updateProfileSchema),
  updateProfile
);

router.get(
  "/profile/:id",
  verifyToken,
  generalLimit,
  validate(getProfileByIdSchema, "params"),
  getProfilebyID
);

router.get(
  "/search",
  verifyToken,
  generalLimit,
  validate(searchUserSchema, "query"),
  searchUsers
);
export default router;
