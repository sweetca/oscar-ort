FROM codescoopltd/oss-review-toolkit:0.1
#FROM analyzer

RUN pip install nodeenv
RUN mkdir /ort-api && chown ort /ort-api
RUN apt-get update && apt-get install -y supervisor
RUN mkdir -p /var/log/supervisor
COPY ./supervisord.conf /etc/supervisord.conf

USER ort
WORKDIR /ort-api

COPY src src
COPY package.json package.json
COPY package-lock.json package-lock.json

RUN npm install

USER root

#ADD ort-633.json codescoop-175906-85f8d1f405f7.json
#RUN echo $SSH_KEY | base64 -d > /root/.ssh/id_rsa
#RUN chmod 600 /root/.ssh/id_rsa

CMD supervisord -c "/etc/supervisord.conf"
