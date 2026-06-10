import { Injectable } from '@nestjs/common';

@Injectable()
export class TestService {
  async getPage() {
    return new Promise((resolve) => {
      const content =
        '<p>1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890</p>'.repeat(
          300,
        ); // 30KB
      setTimeout(() => {
        resolve(`<div>${content}</div>`);
      }, 10);
    });
  }
}
