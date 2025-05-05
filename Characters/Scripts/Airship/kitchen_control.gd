extends Node
@onready var KitchenTimer = $KitchenTimer
var ware_house_current_space : int
var ware_house_max_space : int = 5

func _ready() -> void:
	start_cooking()

func start_cooking () ->void:
	KitchenTimer.start(1)

func end_cooking()-> void:
	dining_out()

func dining_out()-> void:
	ware_house_current_space += 1
	if ware_house_current_space == ware_house_max_space:
		KitchenTimer.stop()

func send_dining(num:int)-> int:
	var picked
	if ware_house_current_space >= num:
		picked = num
		ware_house_current_space-= num
	else:
		picked = ware_house_current_space
		ware_house_current_space = 0
	KitchenTimer.start(1)
	return picked

func _on_kitchen_timer_timeout() -> void:
	end_cooking() # Replace with function body.
