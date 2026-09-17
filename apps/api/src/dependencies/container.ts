import { appLogger } from '@/infra/logging/application-logger';

import { controllerDependency } from './controller.dependency';
import { infraDependency } from './infra.dependency';
import { useCaseDependency } from './use-case.dependency';

export class Container {
  private static instance: Container;
  private readonly dependencies: Map<string, any> = new Map();
  private initialized = false;

  private constructor() {}

  public static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }

    return Container.instance;
  }

  public async init(): Promise<void> {
    const log = appLogger.child({ component: 'Container' });

    if (this.initialized) {
      log.warn('Container already initialized');
      return;
    }

    log.info('Initializing dependencies...');
    await infraDependency(this);
    await useCaseDependency(this);
    await controllerDependency(this);

    this.initialized = true;
    log.info('All dependencies initialized');
  }

  public register<T>(key: string, instance: T): void {
    if (this.dependencies.has(key)) {
      appLogger.child({ component: 'Container' }).warn('Dependency is being overwritten', { dependencyKey: key });
    }

    this.dependencies.set(key, instance);
  }

  public resolve<T>(key: string): T {
    if (!this.dependencies.has(key)) {
      throw new Error(`Dependency '${key}' not found. Available: ${Array.from(this.dependencies.keys()).join(', ')}`);
    }

    return this.dependencies.get(key);
  }

  public has(key: string): boolean {
    return this.dependencies.has(key);
  }

  public clear(): void {
    this.dependencies.clear();
    this.initialized = false;
  }
}
