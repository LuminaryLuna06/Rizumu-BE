import mongoose from "mongoose";
import bcrypt from "bcrypt";
//phần sử lý user
const SALT_ROUNDS = 10;
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    //phần liên quan đến xác thực
    username: { type: String, required: true, unique: true },
    password_hash: { type: String },
    refreshTokens: { type: [String], default: [] },
    refreshToken: { type: String, default: null },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    // thông tin của người dùng
    name: { type: String, default: "" },
    avatar: { type: String, default: null },
    avatar_public_id: { type: String, default: null },
    country: { type: String, default: "", maxlength: 150 },
    bio: { type: String, default: "", maxlength: 150 },
    //thiết kế theo kiểu ai khi tạo tài khoản cũng có phòng riêng
    current_room_id: { type: Schema.Types.ObjectId, ref: "Room" },
    default_room_id: { type: Schema.Types.ObjectId, ref: "Room" },
    status: {
      type: String,
      enum: ["online", "offline", "focus", "break"],
      default: "offline",
    },
  },
  {
    timestamps: true,
  }
);

// phần này liên quan đến bcrypt để hash mật khẩu
UserSchema.virtual("password")
  .set(function (password) {
    this._password = password;
  })
  .get(function () {
    return this._password;
  });

UserSchema.pre("save", async function () {
  if (this.isModified("password_hash")) return;
  if (this._password) {
    this.password_hash = await bcrypt.hash(this._password, SALT_ROUNDS);
  }
});

UserSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password_hash);
};

export default mongoose.model("User", UserSchema);
