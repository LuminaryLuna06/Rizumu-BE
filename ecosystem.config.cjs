module.exports = {
  apps: [
    {
      name: "rizumu-backend",
      cwd: "/home/luna/Github/Rizumu-BE",
      script: "src/server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "rizumu-frontend",
      cwd: "/home/luna/Github/Rizumu-FE",
      script: "npm",
      args: "run preview -- --host 0.0.0.0 --port 5173",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
