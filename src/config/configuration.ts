export interface AppConfig {
  port: number;
}

export default (): AppConfig => ({
  port: Number(process.env.APP_PORT ?? 3000),
});
