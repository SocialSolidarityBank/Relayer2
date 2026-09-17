// 공유 일시 입력(DateTimeInput)을 사람이 쓰는 동선으로 조작한다 — DOM 값 주입 없이
// 달력 대화상자와 오전·오후/시/분 선택을 실제로 누른다. 화면은 한국 시간이다.
// idPrefix: 일정 등록은 'schedule', 기록·인테이크는 'held-at'.
import { expect, type Page } from '@playwright/test';

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }).format(new Date(`${date}T12:00:00+09:00`));

/** 달력 대화상자를 열어 `YYYY-MM-DD` 를 고르고 '선택 완료'로 닫는다. */
export const pickDate = async (page: Page, idPrefix: string, date: string) => {
  const [year, month] = date.split('-').map(Number);
  await page.locator(`#${idPrefix}-date`).click();
  const dialog = page.getByRole('dialog', { name: '상담 날짜 선택', exact: true });
  const shown = (await dialog.getByText(/^\d{4}년 \d{1,2}월$/).textContent())!.match(/(\d+)년 (\d+)월/)!;
  const offset = (year - Number(shown[1])) * 12 + month - Number(shown[2]);
  for (let n = 0; n < Math.abs(offset); n++) {
    await dialog.getByRole('button', { name: offset > 0 ? '다음 달' : '이전 달', exact: true }).click();
  }
  await dialog.getByRole('button', { name: dayLabel(date), exact: true }).click();
  await dialog.getByRole('button', { name: '선택 완료', exact: true }).click();
};

/** `YYYY-MM-DDTHH:mm`(24시간제, 한국 시간)을 날짜 + 오전·오후/시/분으로 채운다. */
export const pickDateTime = async (page: Page, idPrefix: string, value: string) => {
  const [date, time] = value.split('T');
  const [hour, minute] = time.split(':').map(Number);
  await pickDate(page, idPrefix, date);
  await page.locator(`#${idPrefix}-period`).selectOption(hour < 12 ? '오전' : '오후');
  await page.locator(`#${idPrefix}-hour`).selectOption(String(hour % 12 || 12));
  await page.locator(`#${idPrefix}-minute`).selectOption(String(minute).padStart(2, '0'));
};

/** 저장된 ISO 가 화면에 한국 시간으로 그대로 올라왔는지 본다(수정 수화 검증). */
export const expectDateTime = async (page: Page, idPrefix: string, value: string) => {
  const [date, time] = value.split('T');
  const [hour, minute] = time.split(':').map(Number);
  await expect(page.locator(`#${idPrefix}-date`)).toContainText(dayLabel(date));
  await expect(page.locator(`#${idPrefix}-period`)).toHaveValue(hour < 12 ? '오전' : '오후');
  await expect(page.locator(`#${idPrefix}-hour`)).toHaveValue(String(hour % 12 || 12));
  await expect(page.locator(`#${idPrefix}-minute`)).toHaveValue(String(minute).padStart(2, '0'));
};
