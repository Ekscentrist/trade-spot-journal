import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  login(login: string, password: string) {
    const expectedLogin = this.config.getOrThrow<string>('ADMIN_LOGIN');
    const expectedPassword = this.config.getOrThrow<string>('ADMIN_PASSWORD');

    if (login !== expectedLogin || password !== expectedPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwt.sign({ sub: login, role: 'admin' });
    return { accessToken };
  }
}
