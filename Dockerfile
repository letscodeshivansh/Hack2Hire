FROM node

RUN mkdir -p /home/app

WORKDIR /home/app

COPY . .

RUN npm install

EXPOSE 6969

CMD ["node","./src/server.js"]
