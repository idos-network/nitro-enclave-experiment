module.exports = {
	apps: [
		{
			name: "Entropy-service",
			cwd: "/app",
			script: "npm",
			args: "start",
		},
		{
			name: "Caddy",
			cwd: "/app",
			script: "caddy",
			args: "run --config /app/Caddyfile --adapter caddyfile",
			wait_ready: true,
			autorestart: true,
		},
	],
};
