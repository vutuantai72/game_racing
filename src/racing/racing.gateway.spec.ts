import { Test, TestingModule } from '@nestjs/testing';
import { RacingGateway } from './racing.gateway';

describe('RacingGateway', () => {
  let gateway: RacingGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RacingGateway],
    }).compile();

    gateway = module.get<RacingGateway>(RacingGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
