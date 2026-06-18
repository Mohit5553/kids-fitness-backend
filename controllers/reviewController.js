import Review from '../models/Review.js';

// @desc    Create a new review
// @route   POST /api/reviews
// @access  Private
export const createReview = async (req, res, next) => {
  try {
    const { targetType, targetId, rating, comment } = req.body;

    // Check if the user already reviewed this item
    const existingReview = await Review.findOne({ userId: req.user._id, targetType, targetId });
    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this item' });
    }

    const review = await Review.create({
      userId: req.user._id,
      targetType,
      targetId,
      rating,
      comment
    });

    res.status(201).json(review);
  } catch (error) {
    next(error);
  }
};

// @desc    Get all reviews for an item (Class, Plan, Trainer)
// @route   GET /api/reviews/target/:targetType/:targetId
// @access  Public or Private (depending on business rules, usually public)
export const getReviewsByTarget = async (req, res, next) => {
  try {
    const { targetType, targetId } = req.params;
    const reviews = await Review.find({ targetType, targetId, status: 'approved' })
      .populate('userId', 'name email avatarUrl')
      .sort({ createdAt: -1 });

    res.json(reviews);
  } catch (error) {
    next(error);
  }
};

// @desc    Get reviews by the logged-in user
// @route   GET /api/reviews/my
// @access  Private
export const getMyReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ userId: req.user._id })
      .populate('targetId') // Note: this works if targetType matches the Model Name exactly
      .sort({ createdAt: -1 });

    res.json(reviews);
  } catch (error) {
    next(error);
  }
};

// @desc    Get all reviews (for Admin)
// @route   GET /api/reviews
// @access  Private/Admin
export const getAdminReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({})
      .populate('userId', 'name email')
      .populate('targetId')
      .sort({ createdAt: -1 });

    res.json(reviews);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a review (Admin)
// @route   DELETE /api/reviews/:id
// @access  Private/Admin
export const deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    await review.deleteOne();
    res.json({ message: 'Review removed' });
  } catch (error) {
    next(error);
  }
};
