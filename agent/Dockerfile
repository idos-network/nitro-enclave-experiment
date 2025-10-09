FROM node:24-alpine

<<<<<<< HEAD
=======
# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

>>>>>>> ef1b4ed (feat(agent) Cleanup and docker build)
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

<<<<<<< HEAD
# Run the application in production mode
ENV NODE_ENV=production

=======
>>>>>>> ef1b4ed (feat(agent) Cleanup and docker build)
# Expose the port (default 7000)
EXPOSE 7000

# Run the application
CMD ["npm", "run", "start"]
