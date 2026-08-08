FROM node:24-alpine

WORKDIR /app

# Dependencies first so a source edit does not invalidate the install layer.
COPY package.json package-lock.json ./

# ALL dependencies, including dev — deliberately not `npm ci --omit=dev`.
# The migration scripts run through `typeorm-ts-node-commonjs`, which needs
# ts-node and typescript present at runtime; a pruned production image cannot
# run them. Compose also bind-mounts ./src for reload, so a slim image would be
# pretending anyway. This is a development posture, stated openly.
RUN npm ci

COPY . .

EXPOSE 3000

# The `migrate` service overrides this with `npm run migration:run`. Same image
# both times, so the migration and the API are guaranteed to be the same code.
CMD ["npm", "run", "start:dev"]
