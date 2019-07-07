FROM codescoopltd/oss-review-toolkit:0.1
#FROM analyzer

RUN mkdir /ort-api

WORKDIR /ort-api

COPY src src
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

RUN npm start
