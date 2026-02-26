import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Root endpoint',
    description: 'Returns a greeting message confirming the API is reachable.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'API is up and returning a greeting.',
    schema: {
      type: 'string',
      example: 'Hello World!',
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiOperation({
    summary: 'Basic health ping',
    description:
      'Lightweight endpoint returning the current server status and UTC timestamp. ' +
      'Does NOT probe external dependencies — use /health for full dependency checks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Server is running.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
      },
      required: ['status', 'timestamp'],
    },
  })
  getHealth(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
