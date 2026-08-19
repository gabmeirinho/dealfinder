export interface RuntimeService {
  readonly name: string;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** Starts services in order and stops them in reverse order. */
export class LifecycleRuntime {
  readonly #services: readonly RuntimeService[];
  readonly #started: RuntimeService[] = [];
  #state: "idle" | "running" | "stopping" | "stopped" = "idle";

  public constructor(services: readonly RuntimeService[]) {
    this.#services = services;
  }

  public async start(): Promise<void> {
    if (this.#state !== "idle") {
      throw new Error(`Cannot start runtime while it is ${this.#state}`);
    }

    try {
      for (const service of this.#services) {
        await service.start();
        this.#started.push(service);
      }
      this.#state = "running";
    } catch (error: unknown) {
      await this.stopStartedServices();
      this.#state = "stopped";
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.#state === "stopped" || this.#state === "stopping") return;

    this.#state = "stopping";
    await this.stopStartedServices();
    this.#state = "stopped";
  }

  private async stopStartedServices(): Promise<void> {
    const errors: unknown[] = [];

    for (const service of this.#started.splice(0).reverse()) {
      try {
        await service.stop();
      } catch (error: unknown) {
        errors.push(new Error(`Failed to stop ${service.name}`, { cause: error }));
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more runtime services failed to stop");
    }
  }
}
