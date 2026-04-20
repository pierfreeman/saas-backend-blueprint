import { registerAs } from '@nestjs/config';

export default registerAs('ai', () => ({
  openaiApiKey: process.env['OPENAI_API_KEY'] || '',
  azureOpenaiApiKey: process.env['AZURE_OPENAI_API_KEY'] || '',
  azureOpenaiEndpoint: process.env['AZURE_OPENAI_ENDPOINT'] || '',
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] || '',
  googleApiKey: process.env['GOOGLE_API_KEY'] || '',
}));
