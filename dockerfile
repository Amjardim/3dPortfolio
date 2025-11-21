# Build Angular app
FROM node:18 AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build -- --configuration production

# Serve Angular dist from nginx
FROM nginx:latest

# Copy only the BROWSER build
COPY --from=build /app/dist/3d-portfolio/browser /usr/share/nginx/html

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
