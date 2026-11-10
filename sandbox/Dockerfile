# syntax=docker/dockerfile:1

FROM python:3.14-slim

COPY jail.py server.py /opt/sandbox/

# /work/<番号> を実行用のグループにだけ開けるのは、実行中のコードが自分の作業ディレクトリの権限を緩めても、ほかの実行から入れないようにするため。
# setuid を外すのは、no-new-privileges を付けずに起動されたときにも、実行中のコードが権限を上げられないようにするため
RUN mkdir -p /run/sandbox \
  && for i in 0 1 2 3 4 5 6 7; do \
       mkdir -p /work/$i/home && chown root:$((20000 + i)) /work/$i && chmod 0710 /work/$i; \
     done \
  && find / -xdev -type f -perm /6000 -exec chmod a-s {} +

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["python3", "/opt/sandbox/server.py", "health"]
CMD ["python3", "/opt/sandbox/server.py", "serve"]
