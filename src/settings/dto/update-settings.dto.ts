import { IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  okxApiKey?: string;

  @IsOptional()
  @IsString()
  okxSecret?: string;

  @IsOptional()
  @IsString()
  okxPassphrase?: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;

  @IsOptional()
  @IsString()
  telegramChatId?: string;
}
