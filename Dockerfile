FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci
COPY . .
RUN npm run build:web

FROM node:24-alpine AS runtime
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/client/package.json apps/client/package.json
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@flashback/server --workspace=@flashback/contracts --include-workspace-root
COPY --from=build /app/apps/server/src apps/server/src
COPY --from=build /app/packages/contracts packages/contracts
COPY --from=build /app/apps/client/dist apps/client/dist
EXPOSE 4310
CMD ["npm", "start"]
