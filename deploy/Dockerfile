# Build the web client locally with npm run build:web before packaging a release.
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --workspace=@flashback/server --workspace=@flashback/contracts --include-workspace-root
COPY apps/server/src apps/server/src
COPY packages/contracts packages/contracts
COPY scripts scripts
COPY apps/client/dist apps/client/dist
EXPOSE 4310
CMD ["npm", "start"]
