FROM denoland/deno:alpine-1.31.3

WORKDIR /app

COPY . .

RUN deno cache src/main.ts

CMD ["run", "--allow-read", "--allow-env", "--allow-net", "src/main.ts", "/app/config/deleteit.yaml"]
