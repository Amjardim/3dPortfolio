# Build Angular app
FROM node:18 AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build --prod

# Serve Angular dist from nginx
FROM nginx:latest

# FIXED: correct folder name from angular.json
COPY --from=build /app/dist/3d-portfolio /usr/share/nginx/html

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
