import Expense from '../models/Expense.js';

// @desc    Get all expenses
// @route   GET /api/expenses
// @access  Private/Admin
export const getExpenses = async (req, res) => {
  try {
    let query = { isUat: req.isUat === true };

    // Filter by location if specified
    if (req.locationId && req.locationId !== 'all') {
      query.locationId = req.locationId;
    } else if (req.query.locationId && req.query.locationId !== 'all') {
      query.locationId = req.query.locationId;
    }

    if (req.query.category && req.query.category !== 'all') {
      query.category = req.query.category;
    }

    if (req.query.startDate && req.query.endDate) {
      query.date = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }

    const expenses = await Expense.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('locationId', 'name')
      .sort('-date');

    res.json(expenses);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching expenses', error: error.message });
  }
};

// @desc    Create a new expense
// @route   POST /api/expenses
// @access  Private/Admin
export const createExpense = async (req, res) => {
  try {
    const { title, category, amount, currency, date, locationId, receiptUrl, description } = req.body;

    const expense = new Expense({
      title,
      category,
      amount,
      currency: currency || 'AED',
      date: date || Date.now(),
      locationId: locationId || undefined,
      receiptUrl,
      description,
      createdBy: req.user._id,
      isUat: req.isUat === true
    });

    const savedExpense = await expense.save();
    
    // Populate before returning so the frontend can display user/location immediately
    await savedExpense.populate('createdBy', 'firstName lastName');
    await savedExpense.populate('locationId', 'name');

    res.status(201).json(savedExpense);
  } catch (error) {
    res.status(400).json({ message: 'Error creating expense', error: error.message });
  }
};

// @desc    Update an expense
// @route   PUT /api/expenses/:id
// @access  Private/Admin
export const updateExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    // Optional: check if UAT context matches
    if (expense.isUat !== (req.isUat === true)) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    const { title, category, amount, currency, date, locationId, receiptUrl, description } = req.body;

    expense.title = title || expense.title;
    expense.category = category || expense.category;
    expense.amount = amount !== undefined ? amount : expense.amount;
    expense.currency = currency || expense.currency;
    expense.date = date || expense.date;
    expense.locationId = locationId !== undefined ? locationId : expense.locationId;
    expense.receiptUrl = receiptUrl !== undefined ? receiptUrl : expense.receiptUrl;
    expense.description = description !== undefined ? description : expense.description;

    const updatedExpense = await expense.save();
    
    await updatedExpense.populate('createdBy', 'firstName lastName');
    await updatedExpense.populate('locationId', 'name');

    res.json(updatedExpense);
  } catch (error) {
    res.status(400).json({ message: 'Error updating expense', error: error.message });
  }
};

// @desc    Delete an expense
// @route   DELETE /api/expenses/:id
// @access  Private/Admin
export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    if (expense.isUat !== (req.isUat === true)) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await expense.deleteOne();
    res.json({ message: 'Expense removed' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting expense', error: error.message });
  }
};
