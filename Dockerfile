FROM codescoopltd/oss-review-toolkit:0.1
#FROM analyzer

RUN mkdir /ort-api

WORKDIR /ort-api

COPY src src
COPY config.yml config.yml
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

ENV PROFILE=prod
ENV MODE=$APP_MODE
CMD ["npm", "start"]
