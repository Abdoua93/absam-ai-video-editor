export const noneProvider = {
  id: 'none',
  name: 'No engine configured',
  description: 'Disables generation intentionally; useful for demos and tests.',
  capabilities: { textToVideo: false, imageToVideo: false, ratios: [], durations: [] },

  async availability() {
    return {
      available: false,
      reason: 'لم يتم تفعيل أي محرك توليد. اضبط VIDEO_PROVIDER على huggingface-ltx لاستخدام المساحة المجانية.'
    };
  },

  async generate() {
    throw new Error('لا يوجد محرك توليد مُعدّ.');
  }
};
