module.exports = {
	apps: [
		{
			name: "Entropy-service",
			cwd: "/app",
			script: "npm",
			args: "start",
			env: {
				NODE_ENV: "production",
			},
		},
		{
			name: "Caddy",
			cwd: "/app",
			script: "caddy",
			args: "run --config /app/Caddyfile --adapter caddyfile",
			wait_ready: true,
			autorestart: true,
		},
		{
			name: "node-exporter",
			cwd: "/home/deploy",
			script: "node_exporter",
			args: "--no-collector.kernel_hung",
			autorestart: true,
		},
	],
};
