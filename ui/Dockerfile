# A dev-server image, deliberately — not a production nginx build.
#
# The compose file mounts ./src, which only makes sense with hot reload, and
# there is no deployment target for this MVP. The container's job is a clean
# one-command start; day-to-day iteration should use `npm run dev` on the host,
# because Vite hot reload through a volume mount is noticeably laggier on macOS.

FROM node:24-alpine

WORKDIR /app

# Manifests first so `npm ci` is cached independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

# --host 0.0.0.0 is load-bearing: Vite binds loopback by default, and a
# container binding loopback is unreachable from the host.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
