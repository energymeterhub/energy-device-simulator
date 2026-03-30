FROM public.ecr.aws/docker/library/node:22-bookworm-slim

WORKDIR /app

COPY bin ./bin
COPY examples ./examples
COPY src ./src
COPY package.json package-lock.json ./

EXPOSE 5092 1502 1503 18080

ENTRYPOINT ["node", "--experimental-strip-types", "src/cli.ts"]
CMD ["start", "examples/devices/iammeter-wem3080t.dev.json", "--system", "examples/system/docker.json"]
