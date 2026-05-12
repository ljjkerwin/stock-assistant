import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { MonitorService } from './monitor.service';
import { CreateRuleDto } from './dto/create-rule.dto';

@Controller('api/monitor')
export class MonitorController {
  constructor(private readonly monitorService: MonitorService) {}

  @Get('rules')
  getRules() {
    return this.monitorService.getRules();
  }

  @Post('rules')
  createRule(@Body() body: CreateRuleDto) {
    return this.monitorService.createRule(body);
  }

  @Delete('rules/:id')
  deleteRule(@Param('id', ParseIntPipe) id: number) {
    return this.monitorService.deleteRule(id);
  }

  @Patch('rules/:id')
  toggleRule(@Param('id', ParseIntPipe) id: number, @Body('active') active: boolean) {
    return this.monitorService.toggleRule(id, active);
  }

  @Get('messages/unread-count')
  getUnreadCount() {
    return this.monitorService.getUnreadCount();
  }

  @Get('messages')
  getMessages(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.monitorService.getMessages(page);
  }

  @Delete('messages')
  clearMessages() {
    return this.monitorService.clearMessages();
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.monitorService.getEventsStream();
  }
}
