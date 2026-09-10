export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public actualRevision?: number,
  ) {
    super(message);
  }
}
