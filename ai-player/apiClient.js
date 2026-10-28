export class ApiClient {
  constructor(baseUrl, token, timeout = 10000) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.timeout = timeout;
  }
  async request(
    path,
    body,
    method = body === undefined ? "GET" : "POST",
    timeout = this.timeout,
  ) {
    const response = await fetch(this.baseUrl + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.code || "HTTP_ERROR"), {
        code: data.code || "HTTP_ERROR",
        status: response.status,
        retryAfter: Number(response.headers.get("Retry-After")) || 0,
      });
    return data;
  }
}
