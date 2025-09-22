# Use official Node.js LTS image
FROM node:24-alpine3.21

# Set working directory
WORKDIR /app

# Copy the application code
COPY . .

# Install dependencies
RUN npm install

# Expose the port (default: 3000)
EXPOSE 3000

# Use .env file at runtime (handled by docker-compose)
CMD ["npx", "pm2-runtime", "start", "index.js", "-i", "4"]
