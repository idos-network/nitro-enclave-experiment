FROM node:24-alpine

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose the port (default 7000)
EXPOSE 7000

# Run the application
CMD ["npm", "run", "start"]
