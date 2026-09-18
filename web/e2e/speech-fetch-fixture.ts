// 실제 API 서버의 Azure 키 검증 요청만 로컬에서 결정한다. 브라우저와 Relayer API 요청은 가로채지 않는다.
const ISSUE_TOKEN = 'https://koreacentral.api.cognitive.microsoft.com/sts/v1.0/issueToken';
const acceptedKey = process.env.RELAYER_E2E_SPEECH_KEY;
if (!acceptedKey) throw new Error('RELAYER_E2E_SPEECH_KEY is required');

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const [input, init] = args;
  const url = input instanceof Request ? input.url : String(input);
  if (url !== ISSUE_TOKEN) return realFetch(...args);

  const key = new Headers(init?.headers).get('Ocp-Apim-Subscription-Key');
  const accepted = key === acceptedKey;
  return new Response(accepted ? 'token' : 'invalid subscription key', {
    status: accepted ? 200 : 401,
  });
}) as typeof fetch;
