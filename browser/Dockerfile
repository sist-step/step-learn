# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

# 日本語のフォントを入れるのは、ないと文字の幅が変わり、記録する要素の大きさが学生のブラウザと大きくずれるため
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-ipafont-gothic \
  && rm -rf /var/lib/apt/lists/*

COPY server.mjs /opt/browser/

# アプリと同じグループ（1000）の別の利用者で動かすのは、ソケットにアプリからつなげるようにしつつ、アプリの利用者の権限を持たせないため。
# setuid を外すのは、no-new-privileges を付けずに起動されたときにも、Chromium の中のコードが権限を上げられないようにするため
RUN useradd --uid 10001 --gid 1000 --no-create-home --shell /usr/sbin/nologin browser \
  && mkdir -p /run/browser \
  && chown 10001:1000 /run/browser \
  && chmod 0750 /run/browser \
  && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

USER 10001:1000
ENV HOME=/tmp

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "/opt/browser/server.mjs", "health"]
CMD ["node", "/opt/browser/server.mjs", "serve"]
