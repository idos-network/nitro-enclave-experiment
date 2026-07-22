module.exports = {
	apps: [
		{
			name: "encryption",
			cwd: "/app",
			script: "npm",
			args: "start",
			env: {
				NODE_ENV: "production",
			},
			log_type: "json",
			merge_logs: true,
			autorestart: true,
		},
		{
			name: "Caddy",
			cwd: "/app",
			script: "caddy",
			args: "run --config /app/Caddyfile --adapter caddyfile",
			autorestart: true,
			wait_ready: true,
			merge_logs: true,
			log_type: "json",
		},
		{
			name: "node-exporter",
			cwd: "/usr/local/bin",
			script: "node_exporter",
			args: "--no-collector.kernel_hung",
			autorestart: true,
			merge_logs: true,
			log_type: "json",
		},
	],
};
