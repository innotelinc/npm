FROM docker:cli

# Python for the HTTP server, mariadb-client for mysqldump/mysql
RUN apk add --no-cache python3 mariadb-client

WORKDIR /srv
COPY . /srv/

ENV PYTHONUNBUFFERED=1

EXPOSE 80

ENTRYPOINT []
CMD ["/srv/start.sh"]