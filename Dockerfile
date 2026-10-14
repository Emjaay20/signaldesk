# Use official Node LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package definition and install dependencies
COPY package.json ./
RUN npm install && npm run build

# Copy source code and configuration
COPY src ./src
COPY public ./public
COPY tsconfig.json ./

# Expose the application port
EXPOSE 80

# Start the application
CMD ["npm", "run", "start"]