import Progress from "../models/progress.js";

/**
 * Công thức tính XP cần cho level tiếp theo: (50 * Level)^1.2
 */
export const calculateNextLevelXp = (currentLevel) => {
  return Math.round(Math.pow(50 * Math.max(1, currentLevel), 1.2));
};

/**
 * Tự động tính toán và cập nhật phần thưởng cho user khi hoàn thành session
 */
export const awardSessionRewards = async ({
  userId,
  earnedXp,
  earnedCoins,
  isFullPomodoro,
  durationSeconds,
}) => {
  let progress = await Progress.findOne({ user: userId });
  if (!progress) {
    progress = new Progress({ user: userId });
  }

  if (earnedCoins > 0) {
    progress.coins = (progress.coins || 0) + earnedCoins;
  }

  if (isFullPomodoro) {
    progress.promo_complete = (progress.promo_complete || 0) + 1;
    progress.week_promo_complete = (progress.week_promo_complete || 0) + 1;
  }

  if (durationSeconds > 0) {
    progress.total_hours = Number(
      ((progress.total_hours || 0) + durationSeconds / 3600).toFixed(2)
    );
  }

  let leveledUp = false;
  if (earnedXp > 0) {
    progress.current_xp = (progress.current_xp || 0) + earnedXp;

    if (!progress.remaining_xp || progress.remaining_xp === 0) {
      progress.remaining_xp = calculateNextLevelXp(progress.level || 1);
    }

    while (progress.current_xp >= progress.remaining_xp) {
      progress.level = (progress.level || 1) + 1;
      progress.remaining_xp = calculateNextLevelXp(progress.level);
      leveledUp = true;
    }
  }

  progress.updated_at = new Date();
  await progress.save();

  return {
    level: progress.level,
    current_xp: progress.current_xp,
    remaining_xp: progress.remaining_xp,
    coins: progress.coins,
    leveledUp,
  };
};
