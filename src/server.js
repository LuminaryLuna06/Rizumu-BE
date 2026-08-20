import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import homeRoute from "./routes/home.routes.js";
import authRoutes from "./routes/auth.routes.js";
import friendRoutes from "./routes/friend.routes.js";
import roomRoutes from "./routes/room.routes.js";
import messageRoutes from "./routes/message.routes.js";
import progressRoutes from "./routes/progress.routes.js";
import sessionRoutes from "./routes/session.routes.js";
import tagRoute from "./routes/tag.routes.js";
import taskRoute from "./routes/task.routes.js";

import connectDB from "./models/db.js";
import http from "http";
import { Server } from "socket.io";
import chatSocket from "./sockets/chat.socket.js";

import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

//thông báo cho express rằng nó đang nằm sau một proxy
app.set("trust proxy", true);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const allowedOrigins = [
  "http://localhost:5173",
  "https://localhost:5173",
  "http://127.0.0.1:5173",
  "https://127.0.0.1:5173",
  "http://192.168.1.157:5173",
  "https://192.168.1.157:5173",
  "http://192.168.1.3:5173",
  "https://192.168.1.3:5173",
  "https://rizumu-sage.vercel.app",
  "https://rizumu.shore-keeper.com",
  "https://rizumu.shore-keeper.com/",
  "https://rizumu-api.shore-keeper.com",
];

//thiết lập socket
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Export io instance để dùng trong controllers
export { io };

chatSocket(io);

//thiết lập helmet
app.use(
  helmet({
    // Content Security Policy (CSP)
    contentSecurityPolicy: {
      // Explicitly enforce CSP (not report-only mode) - fixes Lighthouse issue
      reportOnly: false,
      directives: {
        defaultSrc: ["'self'"],
        // Cho phép script từ domain của bạn và các nguồn tin cậy
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://rizumu-sage.vercel.app",
          "https://rizumu.shore-keeper.com",
        ],
        // Cho phép Socket.io kết nối
        connectSrc: [
          "'self'",
          ...allowedOrigins,
          "ws://localhost:3001",
          "ws://localhost:3000",
          "wss://rizumu-api.shore-keeper.com",
          "wss://backend-school-pj-1.onrender.com",
        ],
        // Cho phép hiển thị ảnh từ base64 hoặc các link ảnh
        imgSrc: [
          "'self'",
          "data:",
          "https://res.cloudinary.com",
          "https://*.googleusercontent.com",
        ],
        // Cho phép font từ Google hoặc các nguồn khác
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        // Chống nhúng trang web vào iframe để tránh Clickjacking
        frameAncestors: [
          "'self'",
          "https://rizumu-sage.vercel.app",
          "https://rizumu.shore-keeper.com",
        ],
        objectSrc: ["'none'"],
        // Trusted Types directive for DOM XSS protection
        requireTrustedTypesFor: ["'script'"],
        // Allow upgrade to HTTPS
        upgradeInsecureRequests: null,
      },
    },

    //Cho phép frontend load tài nguyên từ backend
    crossOriginResourcePolicy: { policy: "cross-origin" },

    // Cross-Origin Opener Policy (COOP): Bảo vệ khỏi cross-origin attacks
    crossOriginOpenerPolicy: { policy: "same-origin" },

    strictTransportSecurity:
      process.env.NODE_ENV === "production"
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,

    //Referrer Policy: Kiểm soát thông tin referrer
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },

    // Permissions Policy: Kiểm soát browser features
    permissionsPolicy: {
      features: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
        payment: ["'none'"],
      },
    },

    // Ẩn thông tin công nghệ (X-Powered-By: Express)
    hidePoweredBy: true,

    // Chống đánh cắp thông tin qua MIME sniffing
    xContentTypeOptions: true,
  })
);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

//phần dể test phần chat
app.use(express.static(path.join(__dirname, "./public")));
console.log("STATIC PATH:", path.join(__dirname, "./public"));

app.use("/api/health", homeRoute);
app.use("/api/auth", authRoutes);
app.use("/api/friend", friendRoutes);
app.use("/api/room", roomRoutes);
app.use("/api", messageRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/tags", tagRoute);
app.use("/api/task", taskRoute);
//bắt đầu server
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server bắt đầu trên cổng ${PORT}`);
      console.log(`Truy cập thử: http://localhost:${PORT}/home.html`);
    });
  })
  .catch((err) => {
    console.error("Kết nối database thất bại:", err);
  });
