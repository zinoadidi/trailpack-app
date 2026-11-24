# Static frontend served by nginx. The backend address is set when the container starts
# (API_BASE), so the same image works everywhere. No secrets are baked in.
FROM nginx:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/zinoadidi/trailpack-app"
COPY index.html manifest.webmanifest sw.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons
COPY src /usr/share/nginx/html/src
COPY styles /usr/share/nginx/html/styles
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/15-config.sh /docker-entrypoint.d/15-config.sh
EXPOSE 80
