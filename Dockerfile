# Use official Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the backend source code
COPY . .

# If your backend has a build step (optional)
# RUN npm run build

# Expose backend port (change if your backend uses a different port)
EXPOSE 5001

# Start the backend
CMD ["npm", "start"]
