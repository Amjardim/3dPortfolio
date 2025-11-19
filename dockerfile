# Stage 1: build
FROM node:18 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# build production
RUN npm run build -- --configuration production

# Stage 2: serve with nginx
FROM nginx:stable-alpine
# remove default site
RUN rm -rf /usr/share/nginx/html/*
# copy build output
COPY --from=build /app/dist/3d-portfolio /usr/share/nginx/html
# optional: copy custom nginx.conf if you need historyApiFallback for Angular routing
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
