import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  let appController: AppController;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();
    appController = app.get<AppController>(AppController);
  });

  describe('getHello', () => {
    it('returns the running message string', () => {
      expect(appController.getHello()).toContain('running');
    });
  });

  describe('getHealth', () => {
    it('returns status ok with timestamp', () => {
      const result = appController.getHealth();
      expect(result.status).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
    });
  });
});
