import { touchesProtectedTopic } from './recruitment.prompts';

describe('touchesProtectedTopic', () => {
  it.each([
    'How old are you?',
    'Are you married?',
    'Do you have children or plan to?',
    'What is your state of origin?',
    'Which church do you attend?',
    'Do you have any health condition we should know about?',
    'Are you pregnant?',
  ])('catches "%s"', (question) => expect(touchesProtectedTopic(question)).toBe(true));

  it.each([
    'How do you manage competing deadlines?',
    'Tell me about your health and safety training.',
    'How have you worked with recruitment agencies?',
    'Describe a time you handled a difficult stakeholder.',
    'What would you do if a payroll run was late?',
  ])('lets "%s" through', (question) => expect(touchesProtectedTopic(question)).toBe(false));
});
