import app from "./server.ts";

const PORT = process.env.PORT ?? 7000;

const server = app.listen(PORT, () => {
	console.log(`Server started and listening on port ${PORT}`);
});

server.on("error", (err) => {
	if ("code" in err && err.code === "EADDRINUSE") {
		console.error(
			`Port ${PORT} is already in use. Please choose another port or stop the process using it.`,
		);
	} else {
		console.error("Failed to start server:", err);
	}
	process.exit(1);
});
